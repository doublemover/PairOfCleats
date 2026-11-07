text = """prefix \"""
import phantom_template
"""
import actual_template
ordinary = "import ordinary_phantom_template"; import after_semicolon_template
even = """prefix \\"""
import second_actual_template
single = '''prefix \'''
import single_phantom_template
'''
import single_actual_template
# import comment_phantom_template
